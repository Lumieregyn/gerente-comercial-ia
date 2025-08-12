import { Router } from 'express';
import { query } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const reps = await query('SELECT * FROM representatives ORDER BY name');
  res.json(reps.rows);
});

router.post('/', async (req, res) => {
  const { name, phone, email, brandIds } = req.body;
  const result = await query('INSERT INTO representatives(name, phone, email) VALUES($1,$2,$3) RETURNING *', [name, phone, email]);
  const rep = result.rows[0];
  if (Array.isArray(brandIds)) {
    for (const bId of brandIds) {
      await query('INSERT INTO rep_brands(rep_id, brand_id) VALUES($1,$2)', [rep.id, bId]);
    }
  }
  res.status(201).json(rep);
});

export default router;
