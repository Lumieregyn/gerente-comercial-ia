import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import brandsRouter from './routes/brands';
import repsRouter from './routes/reps';
import solicRouter from './routes/solic';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/brands', brandsRouter);
app.use('/api/reps', repsRouter);
app.use('/api/solicitations', solicRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

startScheduler();
