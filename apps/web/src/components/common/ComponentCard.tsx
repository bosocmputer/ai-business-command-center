import React from "react";

interface ComponentCardProps {
  title: string;
  children: React.ReactNode;
  id?: string;
  className?: string; // Additional custom classes for styling
  desc?: string; // Description text
  action?: React.ReactNode;
  bodyClassName?: string;
}

const ComponentCard: React.FC<ComponentCardProps> = ({
  title,
  children,
  id,
  className = "",
  desc = "",
  action,
  bodyClassName = "",
}) => {
  return (
    <div
      id={id}
      className={`rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] ${className}`}
    >
      {/* Card Header */}
      <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            {title}
          </h3>
          {desc && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {desc}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* Card Body */}
      <div
        className={`p-4 border-t border-gray-100 dark:border-gray-800 sm:p-6 ${bodyClassName}`}
      >
        <div className="space-y-6">{children}</div>
      </div>
    </div>
  );
};

export default ComponentCard;
