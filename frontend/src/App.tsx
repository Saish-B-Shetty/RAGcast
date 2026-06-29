import { useAuth } from './hooks/useAuth';
import SignIn from './pages/SignIn';
import MainApp from './pages/MainApp';

export default function App() {
  const { session, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <span className="typing inline-flex gap-1">
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright [animation-delay:.2s]" />
          <i className="h-[7px] w-[7px] animate-blink rounded-full bg-blue-bright [animation-delay:.4s]" />
        </span>
      </div>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return <MainApp user={user} />;
}
