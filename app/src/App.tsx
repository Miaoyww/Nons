import { MotionConfig } from "motion/react";
import { Titlebar } from "@/components/titlebar";
import { MusicWorkspace } from "@/components/player/music-workspace";
import { MusicOptionsProvider } from "@/components/player/music-options";

function App() {


  return (
    <MotionConfig reducedMotion="user">
      <MusicOptionsProvider><div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        <MusicWorkspace />
      </div></MusicOptionsProvider>
    </MotionConfig>
  );
}

export default App;
