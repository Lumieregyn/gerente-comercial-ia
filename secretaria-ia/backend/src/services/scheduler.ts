import cron from 'node-cron';
import { query } from '../db';
import { sendMessage } from './wppconnect';

export function startScheduler() {
  cron.schedule('* * * * *', async () => {
    const due = await query(
      'SELECT s.id, s.message, s.frequency_minutes, r.phone FROM solicitations s JOIN representatives r ON r.id=s.rep_id WHERE s.next_run <= NOW()'
    );
    for (const row of due.rows) {
      await sendMessage(row.phone, row.message);
      await query('UPDATE solicitations SET next_run = NOW() + ($1 || \' minutes\')::interval WHERE id=$2', [row.frequency_minutes, row.id]);
    }
  });
}
