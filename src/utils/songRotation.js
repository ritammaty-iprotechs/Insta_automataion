/**
 * Adds a random "Now Playing" song tag (Hindi or English) to the end
 * of each caption. We only ever reference the song TITLE and ARTIST -
 * never lyrics - so there's no copyright issue with posting this.
 *
 * getRandomSong() - picks one entry at random on every call.
 * formatSongTag() - turns it into the caption line format.
 */

const SONGS = [
  { title: "Kesariya", artist: "Arijit Singh", language: "Hindi" },
  { title: "Tum Hi Ho", artist: "Arijit Singh", language: "Hindi" },
  { title: "Apna Bana Le", artist: "Arijit Singh", language: "Hindi" },
  { title: "Raataan Lambiyan", artist: "Jubin Nautiyal, Asees Kaur", language: "Hindi" },
  { title: "Ilahi", artist: "Arijit Singh", language: "Hindi" },
  { title: "Kal Ho Naa Ho", artist: "Sonu Nigam", language: "Hindi" },
  { title: "Safar (Highway)", artist: "Mohit Chauhan", language: "Hindi" },
  { title: "Phir Se Ud Chala", artist: "Mohit Chauhan", language: "Hindi" },
  { title: "Zinda", artist: "Siddharth Mahadevan", language: "Hindi" },
  { title: "Kabira", artist: "Tochi Raina, Rekha Bhardwaj", language: "Hindi" },
  { title: "Believer", artist: "Imagine Dragons", language: "English" },
  { title: "Stronger", artist: "Kanye West", language: "English" },
  { title: "Unstoppable", artist: "Sia", language: "English" },
  { title: "Roar", artist: "Katy Perry", language: "English" },
  { title: "Firework", artist: "Katy Perry", language: "English" },
  { title: "Counting Stars", artist: "OneRepublic", language: "English" },
  { title: "Good Life", artist: "OneRepublic", language: "English" },
  { title: "Don't Stop Believin'", artist: "Journey", language: "English" },
  { title: "Eye of the Tiger", artist: "Survivor", language: "English" },
  { title: "Levitating", artist: "Dua Lipa", language: "English" },
];

function getRandomSong() {
  const index = Math.floor(Math.random() * SONGS.length);
  return SONGS[index];
}

function formatSongTag(song) {
  const note = song.language === "Hindi" ? "🎵" : "🎧";
  return `${note} Now Playing: ${song.title} – ${song.artist}`;
}

module.exports = { SONGS, getRandomSong, formatSongTag };