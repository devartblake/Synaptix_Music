import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (props: IconProps) => <Icon {...props}><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2a1.1 1.1 0 0 0 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8Z" /></Icon>;
export const PauseIcon = (props: IconProps) => <Icon {...props}><rect x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></Icon>;
export const NextIcon = (props: IconProps) => <Icon {...props}><path d="M3.5 6.2v11.6c0 .7.8 1.1 1.4.7l8.4-5.8a.9.9 0 0 0 0-1.4L4.9 5.5c-.6-.4-1.4 0-1.4.7Zm9.5 0v11.6c0 .7.8 1.1 1.4.7l8.4-5.8a.9.9 0 0 0 0-1.4l-8.4-5.8c-.6-.4-1.4 0-1.4.7Z" /></Icon>;
export const PreviousIcon = (props: IconProps) => <Icon {...props} style={{ transform: "scaleX(-1)" }}><path d="M3.5 6.2v11.6c0 .7.8 1.1 1.4.7l8.4-5.8a.9.9 0 0 0 0-1.4L4.9 5.5c-.6-.4-1.4 0-1.4.7Zm9.5 0v11.6c0 .7.8 1.1 1.4.7l8.4-5.8a.9.9 0 0 0 0-1.4l-8.4-5.8c-.6-.4-1.4 0-1.4.7Z" /></Icon>;
export const RepeatIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5" /></Icon>;
export const ChevronDownIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronLeftIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></Icon>;
export const HomeIcon = (props: IconProps) => <Icon {...props}><path d="M11.3 3.3a1.1 1.1 0 0 1 1.4 0l7.8 6.4c.3.2.5.6.5 1v8.6c0 .9-.7 1.7-1.7 1.7h-3.8a.8.8 0 0 1-.8-.8v-4.8a1 1 0 0 0-1-1h-3.4a1 1 0 0 0-1 1v4.8a.8.8 0 0 1-.8.8H4.7c-1 0-1.7-.8-1.7-1.7v-8.6c0-.4.2-.8.5-1l7.8-6.4Z" /></Icon>;
export const LibraryIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="3.5" width="3.4" height="17" rx="1.2" /><rect x="8.4" y="3.5" width="3.4" height="17" rx="1.2" /><path d="M13.9 5.4a1.2 1.2 0 0 1 1.5-.8l2.7.8a1.2 1.2 0 0 1 .8 1.5l-3.8 13.2a1.2 1.2 0 0 1-1.5.8l-2.7-.8" opacity=".75" /></Icon>;
export const StudioIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="11" width="3" height="9" rx="1.2" /><rect x="8" y="6" width="3" height="14" rx="1.2" /><rect x="13" y="3.5" width="3" height="16.5" rx="1.2" /><rect x="18" y="8.5" width="3" height="11.5" rx="1.2" /></Icon>;
export const SearchIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></Icon>;
export const EditIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Icon>;
export const WaveIcon = (props: IconProps) => <Icon {...props} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0" /></Icon>;
export const InfoIcon = (props: IconProps) => <Icon {...props}><path d="M12 10.5c.7 0 1.2.5 1.2 1.2v6.1a1.2 1.2 0 0 1-2.4 0v-6.1c0-.7.5-1.2 1.2-1.2Zm0-5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" /></Icon>;
