import { useEffect, useState } from 'react';
import axios from 'axios';

export default function SolicForm() {
  const [reps, setReps] = useState<any[]>([]);
  const [repId, setRepId] = useState('');
  const [message, setMessage] = useState('');
  const [frequency, setFrequency] = useState(60);

  useEffect(() => {
    axios.get('/api/reps').then((res) => setReps(res.data));
  }, []);

  const submit = async () => {
    await axios.post('/api/solicitations', {
      repId: parseInt(repId),
      message,
      frequencyMinutes: frequency,
    });
    setRepId('');
    setMessage('');
  };

  return (
    <div className="border p-4 rounded bg-white">
      <h2 className="font-bold mb-2">Nova Solicitação</h2>
      <select className="border p-2 w-full" value={repId} onChange={(e) => setRepId(e.target.value)}>
        <option value="">Selecione o representante</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <textarea
        className="border p-2 w-full mt-2"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Mensagem"
      />
      <input
        type="number"
        className="border p-2 w-full mt-2"
        value={frequency}
        onChange={(e) => setFrequency(parseInt(e.target.value))}
      />
      <button className="bg-green-500 text-white px-4 py-2 mt-2" onClick={submit}>
        Salvar
      </button>
    </div>
  );
}
