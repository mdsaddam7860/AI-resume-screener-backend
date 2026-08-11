import dotenv from "dotenv";
dotenv.config();

import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Resume Screener API listening on http://localhost:${PORT}`);
});
