import "@fontsource-variable/inter";
import "../../design/tokens.css";
import "../../design/accents.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
