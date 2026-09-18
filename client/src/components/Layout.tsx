import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, ChevronDown, FolderOpen, LibraryBig, LogOut, MapPinned, Search, Settings as SettingsIcon, Star, Tags, Trash2, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { api } from "../api/client";
import { isPluginActive } from "../utils/plugins";

// Mirrors life-archive-app's ArchiveNav.tsx: sticky glass header, serif
// wordmark, pill-shaped nav with icon + label links, active item filled
// solid (bg-photo-shell), icon-only circular search button at the end.
const navItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Browse", icon: FolderOpen, end: true },
  { to: "/favorites", label: "Favorites", icon: Star },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const libraryItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/locations", label: "Locations", icon: MapPinned },
  { to: "/people", label: "People", icon: Users },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/cleanup", label: "Cleanup", icon: Trash2 },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [peopleAvailable, setPeopleAvailable] = useState(false);
  const libraryRef = useRef<HTMLDivElement>(null);
  const libraryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setLibraryOpen(false); }, [location.pathname]);
  useEffect(() => { void api.pluginPlatform.list().then(items => setPeopleAvailable(items.some(item => item.id === "com.memorylane.people" && isPluginActive(item)))).catch(() => {}); }, []);
  useEffect(() => {
    if (!libraryOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!libraryRef.current?.contains(event.target as Node)) setLibraryOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setLibraryOpen(false); libraryButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [libraryOpen]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isSearchActive = location.pathname === "/search";
  const libraryActive = libraryItems.some((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-nav-glass px-3 backdrop-blur-xl sm:px-5 lg:px-8">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-2">
          <Link className="shrink-0 font-serif text-lg font-semibold tracking-[-0.03em] text-ink sm:text-2xl" to="/">
            MemoryLane
          </Link>
          <nav className="flex items-center gap-1 rounded-full border border-border bg-nav-pill p-1 text-[13px] font-medium text-nav-muted shadow-nav">
            {navItems.slice(0, 2).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  // Icon-only below sm (a full "Browse / Favorites / Settings"
                  // text row plus search/logout doesn't fit a phone-width
                  // screen at all - it was forcing the whole page to scroll
                  // horizontally) - text labels return once there's room.
                  className={({ isActive }) =>
                    `${item.to === "/favorites" ? "hidden sm:flex" : "flex"} size-9 items-center justify-center gap-2 rounded-full transition sm:w-auto sm:justify-start sm:px-3.5 ${
                      isActive ? "bg-photo-shell text-white" : "hover:bg-hover-soft hover:text-ink"
                    }`
                  }
                >
                  <Icon aria-hidden size={15} strokeWidth={1.8} />
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              );
            })}
            <div ref={libraryRef} className="relative">
              <button ref={libraryButtonRef} type="button" aria-label="Library" aria-expanded={libraryOpen}
                aria-controls="library-menu" onClick={() => setLibraryOpen((open) => !open)}
                className={`flex size-9 items-center justify-center gap-2 rounded-full transition sm:w-auto sm:px-3.5 ${libraryActive || libraryOpen ? "bg-photo-shell text-white" : "hover:bg-hover-soft hover:text-ink"}`}>
                <LibraryBig aria-hidden size={15} strokeWidth={1.8} />
                <span className="hidden sm:inline">Library</span>
                <ChevronDown aria-hidden size={13} className="hidden sm:inline" />
              </button>
              {libraryOpen && <div id="library-menu" className="absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border border-border bg-surface p-1.5 text-ink shadow-card"
                aria-label="Library pages">
                {libraryItems.filter(item => item.to !== "/people" || peopleAvailable).map((item) => {
                  const Icon = item.icon;
                  return <NavLink key={item.to} to={item.to} onClick={() => setLibraryOpen(false)}
                    className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-accent/15 text-accent" : "hover:bg-hover"}`}>
                    <Icon aria-hidden size={16} strokeWidth={1.8} />{item.label}
                  </NavLink>;
                })}
                <div className="my-1 border-t border-border sm:hidden" />
                <NavLink to="/favorites" onClick={() => setLibraryOpen(false)}
                  className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm sm:hidden ${isActive ? "bg-accent/15 text-accent" : "hover:bg-hover"}`}>
                  <Star aria-hidden size={16} />Favorites
                </NavLink>
                <NavLink to="/settings" onClick={() => setLibraryOpen(false)}
                  className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm sm:hidden ${isActive ? "bg-accent/15 text-accent" : "hover:bg-hover"}`}>
                  <SettingsIcon aria-hidden size={16} />Settings
                </NavLink>
              </div>}
            </div>
            {navItems.slice(2).map((item) => {
              const Icon = item.icon;
              return <NavLink key={item.to} to={item.to} title={item.label}
                className={({ isActive }) => `hidden size-9 items-center justify-center gap-2 rounded-full transition sm:flex sm:w-auto sm:px-3.5 ${isActive ? "bg-photo-shell text-white" : "hover:bg-hover-soft hover:text-ink"}`}>
                <Icon aria-hidden size={15} strokeWidth={1.8} />
                <span className="hidden sm:inline">{item.label}</span>
              </NavLink>;
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
      <main className="mx-auto w-full max-w-[1440px] px-3 py-6 sm:px-5 sm:py-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
