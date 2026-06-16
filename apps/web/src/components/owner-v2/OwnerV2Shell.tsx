import Link from "next/link";
import type { ReactNode } from "react";

export function OwnerV2Shell({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <nav>
          <ol className="flex items-center gap-1.5">
            <li>
              <Link
                className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90"
                href="/owner-v2"
              >
                Owner v2
                <svg
                  className="stroke-current"
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
              </Link>
            </li>
            <li className="text-sm text-gray-800 dark:text-white/90">
              {title}
            </li>
          </ol>
        </nav>
      </div>
      {children}
    </>
  );
}
