import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import App from "./App";
import "@mantine/core/styles.css";
import "./App.css";
import { ThemeProvider, useTheme } from "./theme/ThemeContext";

function Root() {
  const { theme, mantineColorScheme } = useTheme();

  return (
    <MantineProvider theme={theme} forceColorScheme={mantineColorScheme}>
      <App />
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </React.StrictMode>,
);
