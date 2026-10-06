import { MotionConfig } from "motion/react";
import { Titlebar } from "@/components/titlebar";
import { MusicWorkspace } from "@/components/player/music-workspace";

function App() {


  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        <MusicWorkspace />
      </div>
    </MotionConfig>
  );
}

export default App;
