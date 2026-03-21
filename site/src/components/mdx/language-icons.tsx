export function LanguageIcons() {
  const languages = [
    { name: 'Go', svg: <GoSvg /> },
    { name: 'Java', svg: <JavaSvg /> },
    { name: 'Python', svg: <PythonSvg /> },
    { name: 'React', svg: <ReactSvg /> },
    { name: 'TypeScript', svg: <TypeScriptSvg /> },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '2rem',
        justifyContent: 'center',
        padding: '1.5rem 0 2rem',
      }}
    >
      {languages.map(({ name, svg }) => (
        <div
          key={name}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <div style={{ width: 44, height: 44 }}>{svg}</div>
          <span style={{ fontSize: '0.75rem', fontWeight: 500, opacity: 0.6 }}>
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

function GoSvg() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="6" fill="#00ADD8" />
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fill="white"
        fontSize="22"
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        Go
      </text>
    </svg>
  );
}

function JavaSvg() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M18 13c0-3 4-4 4-7" stroke="#E76F00" strokeWidth="2" strokeLinecap="round" />
      <path d="M25 13c0-3 4-4 4-7" stroke="#E76F00" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 16h22v14c0 6-5 10-11 10s-11-4-11-10z" fill="#E76F00" />
      <path
        d="M32 20a5 5 0 0 1 0 10"
        stroke="#E76F00"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PythonSvg() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M24 4c-8 0-10 3.5-10 3.5V14h10v2H11c-5.5 0-8 4.5-8 10s2.5 10 8 10h3v-6c0-4 3-7 7-7h10c3 0 5.5-2.5 5.5-5.5V10C36.5 6 33 4 24 4zm-4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"
        fill="#3776AB"
      />
      <path
        d="M24 44c8 0 10-3.5 10-3.5V34H24v-2h13c5.5 0 8-4.5 8-10s-2.5-10-8-10h-3v6c0 4-3 7-7 7H17c-3 0-5.5 2.5-5.5 5.5V38c0 4 3.5 6 12.5 6zm4.5-3.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"
        fill="#FFD43B"
      />
    </svg>
  );
}

function ReactSvg() {
  return (
    <svg width="44" height="44" viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="8" fill="#61DAFB" />
      <g stroke="#61DAFB" strokeWidth="2.5" fill="none">
        <ellipse rx="44" ry="16" />
        <ellipse rx="44" ry="16" transform="rotate(60)" />
        <ellipse rx="44" ry="16" transform="rotate(120)" />
      </g>
    </svg>
  );
}

function TypeScriptSvg() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="6" fill="#3178C6" />
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fill="white"
        fontSize="22"
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        TS
      </text>
    </svg>
  );
}
