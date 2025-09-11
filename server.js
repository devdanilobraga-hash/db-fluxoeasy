const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();

// 🚨 Permite requisições do frontend
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());

app.get("/ping", (req, res) => {
  res.json({ status: "ok", time: new Date() });
});

// Rotas
app.use("/api/usuarios", require("./routes/usuarios"));
app.use("/api/produtos", require("./routes/produtos"));
app.use("/api/entrada", require("./routes/entrada"));
app.use("/api/estoque", require("./routes/estoque"));
app.use("/api/venda", require("./routes/venda"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use('/api/clientes',require("./routes/cliente"));


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
