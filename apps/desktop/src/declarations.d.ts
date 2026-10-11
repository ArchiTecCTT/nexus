/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
declare module "*.css";

// Module virtuel fourni par @vitejs/plugin-react : préambule React Refresh en dev, vide en production.
declare module "@vitejs/plugin-react/preamble";
