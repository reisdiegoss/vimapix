# VimaPIX - Gerador de QR Code e Payload PIX

<p align="center">
  <!-- Badges -->
  <a href="https://github.com/reisdiegoss/vimapix">
    <img src="https://img.shields.io/github/stars/reisdiegoss/vimapix?style=for-the-badge&logo=github&label=Stars" alt="GitHub Stars">
  </a>
  <a href="https://hub.docker.com/r/vimapix/vimapix">
    <img src="https://img.shields.io/docker/pulls/vimapix/vimapix?style=for-the-badge&logo=docker&label=Pulls" alt="Docker Pulls">
  </a>
  <a href="https://github.com/reisdiegoss/vimapix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="Licença: MIT">
  </a>
  <a href="https://vimapix.dominio.com.br">
    <img src="https://img.shields.io/badge/Site-Acessar-blue?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Acessar o Site">
  </a>
</p>

**VimaPIX** é uma aplicação Node.js completa que oferece uma interface web e uma API RESTful para gerar dinamicamente QR Codes e payloads "Copia e Cola" para transações PIX, seguindo as especificações do Banco Central do Brasil.

---

## ? Funcionalidades

- **Interface Web Intuitiva:** Um frontend simples para preencher os dados e gerar o PIX visualmente.
- **API RESTful Robusta:** Um endpoint `/api/generate` para integrações, permitindo que outros sistemas gerem códigos PIX.
- **Geração de QR Code:** Retorna a imagem do QR Code em formato Base64.
- **Payload "Copia e Cola":** Retorna o payload (BR Code) completo para transações.
- **Sem Dependências Externas:** A lógica de geração do PIX é totalmente contida na aplicação.
- **Pronto para Orquestração:** Inclui exemplos para rodar com Docker Swarm e Traefik como proxy reverso.

---

## ?? Como Usar

### 1. Pré-requisitos

- [Node.js](https://nodejs.org/) (v18 ou superior)
- [Docker](https://www.docker.com/) (para rodar em contêiner)

### 2. Rodando Localmente (Para Desenvolvimento)

Primeiro, clone o repositório:
```bash
git clone [https://github.com/reisdiegoss/vimapix.git](https://github.com/reisdiegoss/vimapix.git)
cd VimaPIX
```

Instale as dependências:
```bash
npm install
```

Inicie o servidor de desenvolvimento:
```bash
npm start
```
A aplicação estará disponível em `http://localhost:3000`.

### 3. Executando com Docker

Para rodar a aplicação de forma simples usando a imagem do Docker Hub:

```bash
docker run -d -p 3000:3000 --name VimaPIX vimapix/vimapix:latest
```
Após executar o comando, acesse `http://localhost:3000` no seu navegador.

### 4. Executando com Docker Swarm e Traefik

Esta é a forma recomendada para ambientes de produção, utilizando o Traefik como proxy reverso para gerenciar o tráfego e os certificados SSL.

Crie um arquivo `docker-stack.yml` com o conteúdo abaixo:

```yaml
version: "3.8"

services:
  VimaPIX:
    image: vimapix/vimapix:latest
    hostname: VimaPIX
    networks:
      - network_public
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      resources:
        limits:
          cpus: '0.5'
          memory: 1024M
      labels:
        # --- Configurações do Traefik ---
        - "traefik.enable=true"
        - "traefik.docker.network=network_public"
        # Roteador HTTP para o domínio
        - "traefik.http.routers.VimaPIX.rule=Host(`VimaPIX.dominio.com.br`)"
        - "traefik.http.routers.VimaPIX.entrypoints=websecure"
        - "traefik.http.routers.VimaPIX.service=VimaPIX-svc"
        # Configurações de TLS/SSL com Let's Encrypt
        - "traefik.http.routers.VimaPIX.tls=true"
        - "traefik.http.routers.VimaPIX.tls.certresolver=letsencryptresolver"
        # Definição do serviço e porta da aplicação
        - "traefik.http.services.VimaPIX-svc.loadbalancer.server.port=3000"

networks:
  network_public:
    external: true
```

**Pré-requisitos para o Swarm:**
- Você precisa ter uma instância do Traefik rodando e conectada à rede `network_public`.
- A rede `network_public` deve ser do tipo `overlay` e ter sido criada previamente.
- Altere `VimaPIX.dominio.com.br` para o seu domínio real.

Para implantar a stack, execute:
```bash
docker stack deploy -c docker-stack.yml VimaPIX
```
Após a implantação, acesse `https://VimaPIX.dominio.com.br` no seu navegador.

---

## ?? API Endpoint

A aplicação expõe um endpoint principal para a geração do PIX.

### `POST /api/generate`
Gera o BR Code e o QR Code em Base64.

**Exemplo de requisição com `curl`:**
```bash
curl -X POST [https://VimaPIX.dominio.com.br/api/generate](https://VimaPIX.dominio.com.br/api/generate) \
-H "Content-Type: application/json" \
-d '{
  "pixKey": "seu-email@provedor.com",
  "beneficiaryName": "NOME COMPLETO DO BENEFICIARIO",
  "beneficiaryCity": "SAO PAULO",
  "amount": 19.99,
  "txid": "PEDIDO12345"
}'
```

**Exemplo de resposta (Sucesso `200 OK`):**
```json
{
  "brcode": "00020126580014BR.GOV.BCB.PIX...",
  "qrCodeBase64": "data:image/png;base64,iVBORw0KGgoAAA..."
}
```

---

## ??? Dockerfile
A imagem é construída utilizando um processo multi-stage para otimização, resultando em uma imagem final leve e segura.

```dockerfile
# Etapa 1: Base da Construção
FROM node:18-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production
COPY . .

# Etapa 2: Imagem Final de Produção
FROM node:18-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app .
EXPOSE 3000
USER node
CMD [ "node", "server.js" ]
```

---

## ?? Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para abrir uma *issue* ou enviar um *pull request*.

## ?? Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
