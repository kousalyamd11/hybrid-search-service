const express = require('express');
const cors = require('cors');
const entityRouter = require('./routes/entity');
const searchRouter = require('./routes/search');

const app = express();

app.use(cors());
app.use(express.json());

// Use routers
app.use('/', entityRouter);
app.use('/search', searchRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});