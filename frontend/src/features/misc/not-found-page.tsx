import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/misc';
import { roleHome, useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/common/brand';
import { EmptyState } from '@/components/common/states';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  const { profile } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="card w-full max-w-[520px] p-2">
        <div className="flex justify-center pt-6">
          <Logo size={40} />
        </div>
        <EmptyState
          icon={Compass}
          titleAs="h1"
          title="Page not found"
          message="The page you're looking for doesn't exist."
          action={
            <Button asChild>
              <Link to={profile ? roleHome(profile.role) : '/login'}>{profile ? 'Go to dashboard' : 'Go to sign in'}</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
