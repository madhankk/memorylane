import { Link } from "react-router-dom";
import type { FolderBreadcrumbDto } from "@memorylane/shared";

export default function Breadcrumbs({ items }: { items: FolderBreadcrumbDto[] }) {
  return (
    <nav className="breadcrumbs">
      <Link to="/">Library</Link>
      {items.map((item) => (
        <span key={item.id}>
          {" "}
          / <Link to={`/folder/${item.id}`}>{item.name}</Link>
        </span>
      ))}
    </nav>
  );
}
