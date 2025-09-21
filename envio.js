const nodemailer = require("nodemailer");

async function enviarEmailVencimento(usuario, dataVencimento) {
  const transporter = nodemailer.createTransport({
    host: "smtp.migadu.com",
    port: 465,
    secure: true, // SSL
    auth: {
      user: "suporte@fluxoeasy.com.br",
      pass: process.env.MIGADU_PASS // use variável de ambiente!
    }
  });

  const mailOptions = {
    from: '"Suporte" <suporte@fluxoeasy.com.br>',
    to: usuario.email,
    subject: `Seu pagamento vence em ${dataVencimento}`,
    html: `
      <h2>Olá, ${usuario.nome}!</h2>
      <p>O seu pagamento vence em <strong>${dataVencimento}</strong>.</p>
      <p>Por favor, efetue o pagamento para evitar suspensão do serviço.</p>
      <p>Atenciosamente,<br>Equipe FluxoEasy</p>
    `
  };

  await transporter.sendMail(mailOptions);
  console.log(`E-mail enviado para ${usuario.email}`);
}

// Exemplo de uso
enviarEmailVencimento({ nome: "João", email: "danilobragam@gmail.com" }, "25/09/2025");
