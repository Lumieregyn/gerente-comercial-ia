import { Dispatch, SetStateAction } from 'react';

export interface RepData {
  name: string;
  phone: string;
  email: string;
}

interface Props {
  data: RepData;
  setData: Dispatch<SetStateAction<RepData>>;
  next: () => void;
}

export default function Step1({ data, setData, next }: Props) {
  return (
    <div className="space-y-2">
      <input
        className="border p-2 w-full"
        placeholder="Nome"
        value={data.name}
        onChange={(e) => setData({ ...data, name: e.target.value })}
      />
      <input
        className="border p-2 w-full"
        placeholder="Telefone"
        value={data.phone}
        onChange={(e) => setData({ ...data, phone: e.target.value })}
      />
      <input
        className="border p-2 w-full"
        placeholder="Email"
        value={data.email}
        onChange={(e) => setData({ ...data, email: e.target.value })}
      />
      <button className="bg-blue-500 text-white px-4 py-2" onClick={next}>
        Próximo
      </button>
    </div>
  );
}
