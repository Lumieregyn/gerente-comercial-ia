import wppconnect from 'wppconnect';
import dotenv from 'dotenv';

dotenv.config();

let clientPromise: Promise<wppconnect.Whatsapp> | null = null;

export function getClient() {
  if (!clientPromise) {
    clientPromise = wppconnect.create({ session: process.env.WPP_CONNECT_SESSION || 'session' });
  }
  return clientPromise;
}

export async function sendMessage(phone: string, message: string) {
  const client = await getClient();
  await client.sendText(`${phone}@c.us`, message);
}
