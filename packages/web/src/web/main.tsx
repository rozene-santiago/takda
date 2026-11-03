import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import "./styles.css";
import App from "./app.tsx";
import { notify } from "./lib/save-file";

const queryClient = new QueryClient({
  // Any failed change shows the server's message (e.g. "That period overlaps P2").
  mutationCache: new MutationCache({
    onError: (e: any) => { if (e?.status !== 401) notify(e?.message ?? String(e), "error"); },
  }),
  defaultOptions: {
    queries: { retry: (n, e: any) => e?.status !== 401 && e?.status !== 403 && n < 2 },
  },
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<Router hook={import.meta.env.VITE_HOSTED ? useHashLocation : undefined}>
				<App />
			</Router>
		</QueryClientProvider>
	</StrictMode>,
);
