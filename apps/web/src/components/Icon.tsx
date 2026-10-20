type IconName =
  | "grid"
  | "plus"
  | "arrow"
  | "file"
  | "code"
  | "chevron"
  | "check"
  | "clock"
  | "close"
  | "shield"
  | "folder"
  | "spark";
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    plus: "M12 5v14 M5 12h14",
    arrow: "M12 19V5 M5 12l7-7 7 7",
    file: "M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6",
    code: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
    chevron: "M9 5l7 7-7 7",
    check: "M5 12l4 4L19 6",
    clock: "M12 8v5l3 2 M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0",
    close: "M6 6l12 12 M18 6L6 18",
    shield: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6",
    folder: "M3 5h7l2 3h9v12H3z",
    spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
