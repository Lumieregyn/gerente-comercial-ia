import { Router } from 'express';
import { query } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const result = await query('SELECT * FROM brands ORDER BY name');
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  const result = await query('INSERT INTO brands(name) VALUES($1) RETURNING *', [name]);
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const result = await query('UPDATE brands SET name=$1 WHERE id=$2 RETURNING *', [name, id]);
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await query('DELETE FROM brands WHERE id=$1', [id]);
  res.status(204).end();
});

export default router;
