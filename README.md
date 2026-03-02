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
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="Licen�a: MIT">
  </a>
  <a href="https://vimapix.dominio.com.br">
    <img src="https://img.shields.io/badge/Site-Acessar-blue?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Acessar o Site">
  </a>
</p>

**VimaPIX** � uma aplica��o Node.js completa que oferece uma interface web e uma API RESTful para gerar dinamicamente QR Codes e payloads "Copia e Cola" para transa��es PIX, seguindo as especifica��es do Banco Central do Brasil.

---

## ? Funcionalidades

- **Interface Web Intuitiva:** Um frontend simples para preencher os dados e gerar o PIX visualmente.
- **API RESTful Robusta:** Um endpoint `/api/generate` para integra��es, permitindo que outros sistemas gerem c�digos PIX.
- **Gera��o de QR Code:** Retorna a imagem do QR Code em formato Base64.
- **Payload "Copia e Cola":** Retorna o payload (BR Code) completo para transa��es.
- **Sem Depend�ncias Externas:** A l�gica de gera��o do PIX � totalmente contida na aplica��o.
- **Pronto para Orquestra��o:** Inclui exemplos para rodar com Docker Swarm e Traefik como proxy reverso.

---

## ?? Como Usar

### 1. Pr�-requisitos

- [Node.js](https://nodejs.org/) (v18 ou superior)
- [Docker](https://www.docker.com/) (para rodar em cont�iner)

### 2. Rodando Localmente (Para Desenvolvimento)

Primeiro, clone o reposit�rio:

```bash
git clone https://github.com/reisdiegoss/vimapix.git
cd vimapix
```

Instale as depend�ncias:

```bash
npm install
```

Inicie o servidor de desenvolvimento:

```bash
npm start
```

A aplica��o estar� dispon�vel em `http://localhost:3000`.

### 3. Executando com Docker

Para rodar a aplica��o de forma simples usando a imagem do Docker Hub:

```bash
docker run -d -p 3000:3000 --name VimaPIX vimasistemas/vimapix:latest
```

Ap�s executar o comando, acesse `http://localhost:3000` no seu navegador.

### 4. Executando com Docker Swarm e Traefik

Esta � a forma recomendada para ambientes de produ��o, utilizando o Traefik como proxy reverso para gerenciar o tr�fego e os certificados SSL.

Crie um arquivo `docker-stack.yml` com o conte�do abaixo:

```yaml
version: "3.8"

services:
  VimaPIX:
    image: vimasistemas/vimapix:latest
    hostname: vimapix
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
        # --- Configura��es do Traefik ---
        - "traefik.enable=true"
        - "traefik.docker.network=network_public"
        # Roteador HTTP para o dom�nio
        - "traefik.http.routers.vimapix.rule=Host(`vimapix.dominio.com.br`)"
        - "traefik.http.routers.vimapix.entrypoints=websecure"
        - "traefik.http.routers.vimapix.service=vimapix-svc"
        # Configura��es de TLS/SSL com Let's Encrypt
        - "traefik.http.routers.vimapix.tls=true"
        - "traefik.http.routers.vimapix.tls.certresolver=letsencryptresolver"
        # Defini��o do servi�o e porta da aplica��o
        - "traefik.http.services.vimapix-svc.loadbalancer.server.port=3000"

networks:
  network_public:
    external: true
```

**Pr�-requisitos para o Swarm:**

- Voc� precisa ter uma inst�ncia do Traefik rodando e conectada � rede `network_public`.
- A rede `network_public` deve ser do tipo `overlay` e ter sido criada previamente.
- Altere `vimapix.dominio.com.br` para o seu dom�nio real.

Para implantar a stack, execute:

```bash
docker stack deploy -c docker-stack.yml vimapix
```

Ap�s a implanta��o, acesse `https://vimapix.dominio.com.br` no seu navegador.

---

## ?? API Endpoint

A aplica��o exp�e um endpoint principal para a gera��o do PIX.

### `POST /api/generate`

Gera o BR Code e o QR Code em Base64.

**Exemplo de requisi��o com `curl`:**

```bash
curl -X POST https://vimapix.dominio.com.br/api/generate \
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

A imagem � constru�da utilizando um processo multi-stage para otimiza��o, resultando em uma imagem final leve e segura.

```dockerfile
# Etapa 1: Base da Constru��o
FROM node:18-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production
COPY . .

# Etapa 2: Imagem Final de Produ��o
FROM node:18-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app .
EXPOSE 3000
USER node
CMD [ "node", "server.js" ]
```

---

## ?? Contribuindo

Contribui��es s�o bem-vindas! Sinta-se � vontade para abrir uma *issue* ou enviar um *pull request*.

## ?? Licen�a

Este projeto est� sob a licen�a MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
