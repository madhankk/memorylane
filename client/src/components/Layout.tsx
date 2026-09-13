import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-1.5 text-sm transition-colors ${
      isActive ? "bg-nav-pill text-ink" : "text-nav-muted hover:text-ink"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <header className="sticky top-0 z-40 border-b border-border bg-nav-glass backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3 shadow-nav">
          <Link to="/" className="font-serif text-xl font-semibold tracking-tight text-ink">
            MemoryLane
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Browse
            </NavLink>
            <NavLink to="/search" className={navLinkClass}>
              Search
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              Settings
            </NavLink>
            <button
              onClick={handleLogout}
              className="ml-2 rounded-full px-4 py-1.5 text-sm text-nav-muted transition-colors hover:text-ink"
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
