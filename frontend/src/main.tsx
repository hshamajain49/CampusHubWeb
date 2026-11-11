import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './styles/globals.css';
import { queryClient } from '@/lib/query-client';
import { AuthProvider } from '@/providers/auth-provider';
import { RealtimeProvider } from '@/providers/realtime-provider';
import { TooltipProvider } from '@/components/ui/menus';
import { useIsMdUp } from '@/hooks/misc';
import { router } from './router';

function AppToaster() {
  const mdUp = useIsMdUp();
  return (
    <Toaster
      position={mdUp ? 'top-right' : 'top-center'}
      closeButton
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast: 'font-sans !rounded-[12px] !border-border !shadow-raised',
          title: '!text-[13.5px] !font-semibold !text-ink',
          description: '!text-[12.5px] !text-muted',
        },
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
            <AppToaster />
          </TooltipProvider>
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker for push notifications only (no caching).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
