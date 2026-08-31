const mongoose = require("mongoose");

const Post = require("../models/Post");
const Log = require("../models/Log");
const { getDailyPrompt, getRandomPrompt } = require("../utils/promptrotationdaily");
const { getRandomSong, formatSongTag } = require("../utils/songRotation");
const { generateCaption, generateImage } = require("../services/aiService");
const { overlayFactOnImage } = require("../services/imageComposeService");
const { uploadImageToCloudinary } = require("../services/uploadService");
const { postImageToInstagram } = require("../services/instagramService");

function isValidPostId(postId) {
  return Boolean(postId) && mongoose.isValidObjectId(postId);
}

function normalizeMessage(message) {
  if (message == null) return "";
  if (typeof message === "string") return message;

  try {
    return JSON.stringify(message);
  } catch (_) {
    return String(message);
  }
}

// Logging and post updates are best-effort. A DB write problem should not stop the post.
async function writeLog(postId, stage, status, message) {
  if (!isValidPostId(postId)) {
    return null;
  }

  try {
    return await Log.create({
      postId,
      stage,
      status,
      message: normalizeMessage(message).slice(0, 1000),
    });
  } catch (err) {
    console.error(`[Pipeline] Failed to write ${stage} log:`, err.message);
    return null;
  }
}

async function updatePost(postId, update) {
  if (!isValidPostId(postId)) {
    return null;
  }

  try {
    return await Post.findByIdAndUpdate(postId, update, { new: true });
  } catch (err) {
    console.error(`[Pipeline] Failed to update post ${postId}:`, err.message);
    return null;
  }
}

async function failPipeline({ postId, stage, error, postUpdate = {}, details = {} }) {
  await writeLog(postId, stage, "failure", error);
  await updatePost(postId, {
    ...postUpdate,
    status: "failed",
    errorMessage: error,
  });

  return {
    success: false,
    failedStage: stage,
    error,
    ...details,
  };
}

/**
 * @param {string} promptMode - "daily" (default) uses the fixed,
 *   day-indexed rotation - this is what cron and the default /run-now
 *   hit use, so real automated posts always follow the 30-day order.
 *   "random" picks a random day's theme on every call - used ONLY for
 *   manual testing via /run-now?random=true, never for real automation.
 */
async function runDailyPostPipeline({
  postId,
  igUserId,
  accessToken,
  accountId = null,
  promptMode = "daily",
}) {
  if (!postId) {
    throw new Error("postId is required");
  }

  if (!igUserId) {
    throw new Error("igUserId is required");
  }

  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const dailyPrompt = promptMode === "random" ? getRandomPrompt() : getDailyPrompt();
  const pipelineDetails = {
    postId,
    accountId,
    promptMode,
    themeKey: dailyPrompt.themeKey,
    cycleDay: dailyPrompt.cycleDay,
    cycleLength: dailyPrompt.cycleLength,
  };

  try {
    await updatePost(postId, {
      status: "processing",
      errorMessage: "",
    });

    const captionResult = await generateCaption(dailyPrompt.captionTopic);
    if (!captionResult.success) {
      return failPipeline({
        postId,
        stage: "caption_generation",
        error: captionResult.error,
        details: pipelineDetails,
      });
    }

    // Pick a random Hindi/English song and append it as a "Now Playing"
    // tag at the end of the caption. Title + artist only - no lyrics -
    // so this never touches copyright.
    const song = getRandomSong();
    const finalCaption = `${captionResult.caption}\n\n${formatSongTag(song)}`;

    await writeLog(
      postId,
      "caption_generation",
      "success",
      `Generated caption for ${dailyPrompt.themeKey} (song: ${song.title} - ${song.artist})`
    );
    await updatePost(postId, {
      caption: finalCaption,
    });

    const imageResult = await generateImage(dailyPrompt.imagePrompt);
    if (!imageResult.success) {
      return failPipeline({
        postId,
        stage: "image_generation",
        error: imageResult.error,
        postUpdate: { caption: finalCaption },
        details: pipelineDetails,
      });
    }

    await writeLog(
      postId,
      "image_generation",
      "success",
      `Generated image for ${dailyPrompt.themeKey}`
    );

    // Draw the day's real fact directly onto the image (quote-card
    // style banner) - reliable, correctly spelled, unlike asking the
    // AI image model to render text itself.
    let composedBase64 = imageResult.base64Data;
    let composedMimeType = imageResult.mimeType;

    try {
      const backgroundBuffer = Buffer.from(imageResult.base64Data, "base64");
      const composedBuffer = await overlayFactOnImage({
        imageBuffer: backgroundBuffer,
        factText: dailyPrompt.factText,
      });
      composedBase64 = composedBuffer.toString("base64");
      composedMimeType = "image/jpeg";

      await writeLog(
        postId,
        "image_compose",
        "success",
        `Overlaid fact text for ${dailyPrompt.themeKey}`
      );
    } catch (composeErr) {
      // Non-fatal: fall back to the plain background image rather than
      // failing the whole pipeline over a text-overlay problem.
      console.error("[Pipeline] Image compose failed, using plain background:", composeErr.message);
      await writeLog(postId, "image_compose", "failure", composeErr.message);
    }

    const uploadResult = await uploadImageToCloudinary({
      base64Data: composedBase64,
      mimeType: composedMimeType,
    });

    if (!uploadResult.success) {
      return failPipeline({
        postId,
        stage: "image_upload",
        error: uploadResult.error,
        postUpdate: { caption: finalCaption },
        details: pipelineDetails,
      });
    }

    await writeLog(postId, "image_upload", "success", "Uploaded image to Cloudinary");
    await updatePost(postId, {
      imageUrl: uploadResult.publicUrl,
    });

    const publishResult = await postImageToInstagram({
      igUserId,
      accessToken,
      imageUrl: uploadResult.publicUrl,
      caption: finalCaption,
    });

    if (!publishResult.success) {
      return failPipeline({
        postId,
        stage: publishResult.stage || "media_publish",
        error: publishResult.error,
        postUpdate: {
          caption: finalCaption,
          imageUrl: uploadResult.publicUrl,
        },
        details: pipelineDetails,
      });
    }

    await writeLog(
      postId,
      "media_container",
      "success",
      `Created Instagram container ${publishResult.creationId}`
    );
    await writeLog(
      postId,
      "media_publish",
      "success",
      `Published Instagram media ${publishResult.igMediaId}`
    );

    const publishedAt = new Date();
    await updatePost(postId, {
      caption: finalCaption,
      imageUrl: uploadResult.publicUrl,
      igCreationId: publishResult.creationId,
      igMediaId: publishResult.igMediaId,
      status: "posted",
      publishedAt,
      errorMessage: "",
    });

    return {
      success: true,
      ...pipelineDetails,
      caption: finalCaption,
      imageUrl: uploadResult.publicUrl,
      igCreationId: publishResult.creationId,
      igMediaId: publishResult.igMediaId,
      publishedAt,
    };
  } catch (err) {
    const errorMessage = err.message || String(err);
    console.error("[Pipeline] Unexpected failure:", errorMessage);

    await updatePost(postId, {
      status: "failed",
      errorMessage,
    });

    return {
      success: false,
      failedStage: "pipeline",
      error: errorMessage,
      ...pipelineDetails,
    };
  }
}

module.exports = { runDailyPostPipeline };