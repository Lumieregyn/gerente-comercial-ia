import RepWizard from './components/RepWizard/RepWizard';
import SolicForm from './components/SolicForm/SolicForm';

export default function App() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Secretaria IA</h1>
      <RepWizard />
      <div className="mt-8">
        <SolicForm />
      </div>
    </div>
  );
}
