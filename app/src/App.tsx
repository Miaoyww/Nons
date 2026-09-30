import { MotionConfig } from "motion/react";
import { Titlebar } from "@/components/titlebar";

function App() {


  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        <main className="min-h-0 flex-1 overflow-auto" aria-label="Nons 工作区" />
      </div>
    </MotionConfig>
  );
}

export default App;
