const express = require("express");
const cors = require("cors");
const axios = require("axios"); // para fazer o ping
require("dotenv").config();
const app = express();
const path = require('path');
const checkClienteAtivo = require("./middleware/checkClienteAtivo");
const auth = require("./middleware/auth");
const getPlano = require("./middleware/plano");


// 🚨 Permite requisições do frontend
app.use(cors({
  origin: "*",
  credentials: true
}));

app.use(express.json());

// Rota /ping registrada **uma única vez**
app.get("/ping", (req, res) => {
  res.json({ status: "ok", time: new Date() });
});


const pingServer = () => {
  axios.get(`https://db-fluxoeasy-idq9.onrender.com/ping`)
    .then(res => console.log(`Ping enviado: ${new Date().toLocaleTimeString()}`))
    .catch(err => console.error("Erro ao enviar ping:", err.message));
}

// Dispara o ping a cada 10 minutos (10 * 60 * 1000 ms)
setInterval(pingServer, 10 * 60 * 1000);

// Ping imediato ao iniciar o servidor
pingServer();

// Serve arquivos da pasta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/clientes',require("./routes/cliente"));
app.use("/api/usuarios", require("./routes/usuarios"));
app.use("/api/planos", require("./routes/planos"));

// Rotas
app.use("/api/produtos", auth, checkClienteAtivo, getPlano, require("./routes/produtos"));
app.use("/api/entrada", auth, checkClienteAtivo, getPlano, require("./routes/entrada"));
app.use("/api/estoque", auth, checkClienteAtivo, getPlano, require("./routes/estoque"));
app.use("/api/venda", auth, checkClienteAtivo, getPlano, require("./routes/venda"));
app.use("/api/dashboard", auth, checkClienteAtivo, getPlano, require("./routes/dashboard"));
app.use("/api/calendario", auth, checkClienteAtivo, getPlano, require("./routes/calendario"));
app.use("/api/aluguel", auth, checkClienteAtivo, getPlano, require("./routes/aluguel"));
app.use("/api/despesas", auth, checkClienteAtivo, getPlano, require("./routes/despesas"));
app.use("/api/email", require("./routes/email"));
app.use("/api/sub-clientes", require("./routes/subCliente"));
app.use("/api/orcamentos", require("./routes/orcamento"));
app.use("/api/faturamento", require("./routes/faturamento"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
