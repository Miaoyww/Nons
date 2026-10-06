import { MotionConfig } from "motion/react";
import { Titlebar } from "@/components/titlebar";
import { MusicWorkspace } from "@/components/player/music-workspace";
import { MusicOptionsProvider } from "@/components/player/music-options";
import { MusicNavigationProvider } from "@/components/player/music-navigation";
import { AccountProvider } from "@/components/player/account";
import { useState } from "react";

function App() {
  const [nowPlaying, setNowPlaying] = useState(false);
  return (
    <MotionConfig reducedMotion="user">
      <AccountProvider><MusicOptionsProvider><MusicNavigationProvider><div className={`relative flex h-dvh flex-col overflow-hidden bg-background text-foreground ${nowPlaying ? "now-playing" : ""}`}>
        <Titlebar playerMode={nowPlaying} onBack={() => setNowPlaying(false)} />
        <MusicWorkspace nowPlaying={nowPlaying} onNowPlayingChange={setNowPlaying} />
      </div></MusicNavigationProvider></MusicOptionsProvider></AccountProvider>
    </MotionConfig>
  );
}

export default App;
