import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FolderOpen, LogOut, Search, Settings as SettingsIcon, Star, type LucideIcon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

// Mirrors life-archive-app's ArchiveNav.tsx: sticky glass header, serif
// wordmark, pill-shaped nav with icon + label links, active item filled
// solid (bg-photo-shell), icon-only circular search button at the end.
const navItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Browse", icon: FolderOpen, end: true },
  { to: "/favorites", label: "Favorites", icon: Star },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isSearchActive = location.pathname === "/search";

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-nav-glass px-5 backdrop-blur-xl lg:px-8">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between">
          <Link className="font-serif text-2xl font-semibold tracking-[-0.03em] text-ink" to="/">
            MemoryLane
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-border bg-nav-pill p-1 text-[13px] font-medium text-nav-muted shadow-nav">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `inline-flex h-9 items-center gap-2 rounded-full px-3.5 transition ${
                      isActive ? "bg-photo-shell text-white" : "hover:bg-hover-soft hover:text-ink"
                    }`
                  }
                >
                  <Icon aria-hidden size={15} strokeWidth={1.8} />
                  {item.label}
                </NavLink>
              );
            })}
            <Link
              to="/search"
              aria-label="Search"
              title="Search"
              className={`grid size-9 place-items-center rounded-full transition ${
                isSearchActive ? "bg-photo-shell text-white" : "hover:bg-hover-soft hover:text-ink"
              }`}
            >
              <Search aria-hidden size={16} strokeWidth={1.8} />
            </Link>
            {user && (
              <Link
                to="/settings"
                title="Signed in - go to Settings to change your password"
                className="hidden px-2 text-xs text-nav-muted hover:text-ink sm:inline"
              >
                {user.username}
              </Link>
            )}
            <button
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="grid size-9 place-items-center rounded-full text-nav-muted transition hover:bg-hover-soft hover:text-ink"
            >
              <LogOut aria-hidden size={15} strokeWidth={1.8} />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-5 py-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
