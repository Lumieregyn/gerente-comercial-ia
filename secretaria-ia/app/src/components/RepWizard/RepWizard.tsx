import { useState } from 'react';
import Step1, { RepData } from './Step1';
import Step2 from './Step2';
import Step3 from './Step3';

export default function RepWizard() {
  const [step, setStep] = useState(1);
  const [rep, setRep] = useState<RepData>({ name: '', phone: '', email: '' });
  const [brands, setBrands] = useState<number[]>([]);

  const reset = () => {
    setStep(1);
    setRep({ name: '', phone: '', email: '' });
    setBrands([]);
  };

  return (
    <div className="border p-4 rounded bg-white">
      {step === 1 && <Step1 data={rep} setData={setRep} next={() => setStep(2)} />}
      {step === 2 && (
        <Step2
          selected={brands}
          setSelected={setBrands}
          back={() => setStep(1)}
          next={() => setStep(3)}
        />
      )}
      {step === 3 && <Step3 rep={rep} brands={brands} back={() => setStep(2)} reset={reset} />}
    </div>
  );
}
