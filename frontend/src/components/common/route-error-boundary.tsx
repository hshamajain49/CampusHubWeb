import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { RotateCw } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from './states';
import { Logo } from './brand';

export function RouteErrorBoundary() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="card w-full max-w-[520px] p-2">
        <div className="flex justify-center pt-6">
          <Logo size={40} />
        </div>
        {notFound ? (
          <EmptyState title="Page not found" message="The page you're looking for doesn't exist." action={<Button asChild><Link to="/">Go home</Link></Button>} />
        ) : (
          <EmptyState
            tone="danger"
            title="Something went wrong"
            message={
              <>
                Please reload the page. If this keeps happening, contact the administrator.
                {requestId && <span className="mt-2 block font-mono text-[12px] text-subtle">Request ID {requestId}</span>}
              </>
            }
            action={
              <>
                <Button onClick={() => window.location.reload()}>
                  <RotateCw /> Reload
                </Button>
                <Button variant="outline" asChild>
                  <a href="/">Go home</a>
                </Button>
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
