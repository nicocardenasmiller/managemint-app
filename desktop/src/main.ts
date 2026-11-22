import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "../../design/tokens.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
