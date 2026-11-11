/** The faint cotton-boll pattern behind the green screen headers (Home, Yordam). `id` must be unique per screen. */
export function CottonPattern({ id }: { id: string }) {
  return (
    <svg className="home-head-pattern" aria-hidden width="100%" height="100%" focusable={false}>
      <defs>
        <pattern id={id} width="64" height="64" patternUnits="userSpaceOnUse">
          <g fill="#b8e8cf">
            <circle cx="13" cy="13" r="4.5" /><circle cx="21" cy="13" r="4.5" /><circle cx="17" cy="8" r="4.5" /><circle cx="17" cy="17" r="4.5" />
            <path d="M17 21l-4.5 7h9z" />
            <circle cx="45" cy="45" r="4.5" /><circle cx="53" cy="45" r="4.5" /><circle cx="49" cy="40" r="4.5" /><circle cx="49" cy="49" r="4.5" />
            <path d="M49 53l-4.5 7h9z" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity="0.13" />
    </svg>
  );
}
