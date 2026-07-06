import Link from "next/link";
import type { ReactNode } from "react";

export type OwnerV2BreadcrumbItem = {
  href?: string;
  label: ReactNode;
};

export function OwnerV2Shell({
  breadcrumbs,
  children,
  subtitle,
  title,
}: {
  breadcrumbs?: OwnerV2BreadcrumbItem[];
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  const trail =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs
      : [{ label: title } satisfies OwnerV2BreadcrumbItem];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <nav aria-label="เส้นทางหน้า" className="shrink-0">
          <ol className="flex flex-wrap items-center justify-end gap-1.5">
            <li>
              <Link
                className="inline-flex min-h-10 items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
                href="/owner-v2"
              >
                หน้าแรก
              </Link>
            </li>
            {trail.map((item, index) => {
              const isLast = index === trail.length - 1;
              return (
                <li className="inline-flex items-center gap-1.5" key={index}>
                  <BreadcrumbSeparator />
                  {item.href && !isLast ? (
                    <Link
                      className="inline-flex min-h-10 items-center text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={isLast ? "page" : undefined}
                      className="inline-flex min-h-10 items-center text-sm text-gray-800 dark:text-white/90"
                    >
                      {item.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      {children}
    </>
  );
}

function BreadcrumbSeparator() {
  return (
    <svg
      aria-hidden="true"
      className="stroke-gray-400 dark:stroke-gray-600"
      fill="none"
      height="16"
      viewBox="0 0 17 16"
      width="17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.0765 12.667L10.2432 8.50033L6.0765 4.33366"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}
