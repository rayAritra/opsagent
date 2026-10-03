"use client";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const d = localStorage.getItem("theme") !== "light";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
  }, []);
  return (
    <button
      className="theme"
      aria-label="Toggle color theme"
      onClick={() => {
        const d = !dark;
        setDark(d);
        document.documentElement.classList.toggle("dark", d);
        localStorage.setItem("theme", d ? "dark" : "light");
      }}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
