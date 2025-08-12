import { Router } from 'express';
import { query } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const result = await query('SELECT * FROM solicitations');
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { repId, message, frequencyMinutes } = req.body;
  const result = await query(
    'INSERT INTO solicitations(rep_id, message, frequency_minutes, next_run) VALUES($1,$2,$3,NOW()) RETURNING *',
    [repId, message, frequencyMinutes]
  );
  res.status(201).json(result.rows[0]);
});

export default router;
