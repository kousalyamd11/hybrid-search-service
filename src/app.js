const express = require('express');
const cors = require('cors');
const entityRouter = require('./routes/entity');

const app = express();

app.use(cors());
app.use(express.json());

// Use the entity router
app.use('/', entityRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});