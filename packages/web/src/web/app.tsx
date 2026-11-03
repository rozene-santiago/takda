import { Route, Switch, Redirect } from "wouter";
import Index from "./pages/index";
import TeachersPage from "./pages/teachers";
import TeacherSchedulePage from "./pages/teacher-schedule";
import RoomSchedulePage from "./pages/room-schedule";
import SubstitutionsPage from "./pages/substitutions";
import TeachingLoadsPage from "./pages/teaching-loads";
import AllocationsPage from "./pages/allocations";
import ReportsPage from "./pages/reports";
import SetupPage from "./pages/setup";
import { Provider } from "./components/provider";
import { AuthGate } from "./components/auth-gate";
import { ConfirmProvider } from "./lib/confirm";
import { HistoryProvider } from "./lib/history";
import { AccessProvider } from "./lib/access";
import { useLocked } from "./lib/hooks";
import { SaveStatus } from "./components/save-status";

// Editing pages are hidden in lockdown / view-only mode → send home.
function LockGuard({ component: Component }: { component: React.ComponentType }) {
  const locked = useLocked();
  if (locked) return <Redirect to="/" />;
  return <Component />;
}

function App() {
  return (
    <Provider>
      <AccessProvider>
        <AuthGate>
          <ConfirmProvider>
            <HistoryProvider>
              <Switch>
                <Route path="/" component={Index} />
                <Route path="/teacher-schedule" component={TeacherSchedulePage} />
                <Route path="/rooms" component={RoomSchedulePage} />
                <Route path="/substitutions" component={SubstitutionsPage} />
                <Route path="/loads"><LockGuard component={TeachingLoadsPage} /></Route>
                <Route path="/teachers"><LockGuard component={TeachersPage} /></Route>
                <Route path="/allocations"><LockGuard component={AllocationsPage} /></Route>
                <Route path="/reports" component={ReportsPage} />
                <Route path="/setup"><LockGuard component={SetupPage} /></Route>
                <Route><Redirect to="/" /></Route>
              </Switch>
              <SaveStatus />
            </HistoryProvider>
          </ConfirmProvider>
        </AuthGate>
      </AccessProvider>
    </Provider>
  );
}

export default App;
