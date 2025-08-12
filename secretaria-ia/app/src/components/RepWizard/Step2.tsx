import { useEffect, useState } from 'react';
import axios from 'axios';

interface Props {
  selected: number[];
  setSelected: (s: number[]) => void;
  next: () => void;
  back: () => void;
}

export default function Step2({ selected, setSelected, next, back }: Props) {
  const [brands, setBrands] = useState<any[]>([]);
  useEffect(() => {
    axios.get('/api/brands').then((res) => setBrands(res.data));
  }, []);
  const toggle = (id: number) => {
    setSelected(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);
  };
  return (
    <div>
      <ul className="space-y-1">
        {brands.map((b) => (
          <li key={b.id}>
            <label className="flex items-center space-x-2">
              <input type="checkbox" checked={selected.includes(b.id)} onChange={() => toggle(b.id)} />
              <span>{b.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-x-2">
        <button className="bg-gray-300 px-4 py-2" onClick={back}>
          Voltar
        </button>
        <button className="bg-blue-500 text-white px-4 py-2" onClick={next}>
          Próximo
        </button>
      </div>
    </div>
  );
}
