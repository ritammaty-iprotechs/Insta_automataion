import express from 'express'

const app = express()

app.use(express.json())

app.get('/', (req, res) => {
    res.send('Hello This is Ritam , i am working on it ')
})

export default app