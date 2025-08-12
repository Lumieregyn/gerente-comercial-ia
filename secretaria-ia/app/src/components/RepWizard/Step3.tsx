import { useState } from 'react';
import axios from 'axios';
import { RepData } from './Step1';

interface Props {
  rep: RepData;
  brands: number[];
  reset: () => void;
  back: () => void;
}

export default function Step3({ rep, brands, reset, back }: Props) {
  const [message, setMessage] = useState('Atualize seu saldo de estoque, por favor.');
  const [frequency, setFrequency] = useState(60);

  const submit = async () => {
    const repRes = await axios.post('/api/reps', { ...rep, brandIds: brands });
    await axios.post('/api/solicitations', {
      repId: repRes.data.id,
      message,
      frequencyMinutes: frequency,
    });
    reset();
  };

  return (
    <div className="space-y-2">
      <textarea
        className="border p-2 w-full"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <input
        type="number"
        className="border p-2 w-full"
        value={frequency}
        onChange={(e) => setFrequency(parseInt(e.target.value))}
        min={1}
      />
      <div className="space-x-2">
        <button className="bg-gray-300 px-4 py-2" onClick={back}>
          Voltar
        </button>
        <button className="bg-green-500 text-white px-4 py-2" onClick={submit}>
          Salvar
        </button>
      </div>
    </div>
  );
}
