# NTIBIX — Monitoramento e Observabilidade

Painel de monitoramento e observabilidade desenvolvido com React, Node.js,
Express e MySQL/MariaDB. O banco do Zabbix é usado somente para leitura das
métricas; um banco próprio armazena as configurações, contas e sessões.

## Acesso e grupos

Na primeira inicialização, se ainda não existir `data/users.json`, o sistema
cria a conta de teste `nti` com a senha `ntim4ster` no grupo administrador.
Troque essa senha antes de disponibilizar o sistema a outras pessoas ou à rede.
As senhas são armazenadas como hashes scrypt; o arquivo de usuários e as sessões
nunca são compartilhados com o banco do Zabbix.

Entre pela rota `#/login`. Administradores têm acesso total e gerenciam contas;
moderadores podem adicionar indicadores e seções e mover cards, mas não podem
excluir nem editar conteúdo existente ou configurações globais; visualizadores
acessam somente os painéis atribuídos pelo administrador. O acesso à API também
é protegido por sessão, não apenas pela interface. As sessões expiram após
oito horas e continuam válidas após reinicializações do servidor. O arquivo
local `data/sessions.json` contém apenas hashes dos tokens das sessões ativas.

## Requisitos

- Node.js 22 ou superior
- Conta MySQL/MariaDB dedicada para a aplicação, com acesso ao banco
  `monitoring_nti`
- Conta MySQL/MariaDB do Zabbix com permissão `SELECT` nas tabelas `hosts`,
  `items`, `history` e `history_uint`
- A API precisa alcançar o servidor de banco na porta configurada

## Configuração local

Na pasta `monitoring-nti-pf-al`, instale as dependências e crie o arquivo local
de configuração:

```bash
npm install
cp .env.example .env
```

Edite `.env` com os dados de acesso do banco do Zabbix (`DB_*`) e do banco da
aplicação (`APP_DB_*`). Eles são conexões independentes: mantenha o banco do
Zabbix com permissão somente de leitura e use uma conta própria da aplicação
com acesso apenas ao schema `monitoring_nti`. Não use `root` na aplicação.
O `.env` é ignorado pelo Git; não coloque credenciais no repositório.

Crie o banco e a conta dedicada uma única vez, usando um administrador do
MySQL/MariaDB. Gere uma senha forte exclusiva e informe-a em `APP_DB_PASSWORD`:

```sql
CREATE DATABASE monitoring_nti CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'nti'@'192.168.65.1' IDENTIFIED BY 'SUBSTITUA_POR_UMA_SENHA_FORTE';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
  ON monitoring_nti.* TO 'nti'@'192.168.65.1';
```

O host na conta MySQL é o endereço de origem visto pelo servidor do banco, não
o endereço do banco definido em `APP_DB_HOST`. Ajuste-o para o IP da API no seu
ambiente; evite liberar a conta com host `%`.

Na primeira inicialização, a aplicação cria as tabelas necessárias e importa
`data/dashboard.json`, `data/users.json` e `data/sessions.json` caso existam e
as tabelas correspondentes ainda estejam vazias. Os arquivos originais não são
apagados automaticamente: mantenha um backup até confirmar a migração.
`APP_DATA_DIR` pode apontar para a pasta desses JSONs se ela não estiver em
`data/` no diretório de execução.

Inicie a API e o Vite juntos:

```bash
npm run dev
```

Abra o endereço local informado pelo Vite (normalmente
`http://localhost:5173`). O proxy encaminha `/api` para a API Express na porta
`3001`.

Verifique as conexões SQL do Zabbix e da aplicação em
`http://localhost:3001/api/health`.
`/api/dashboard` retorna os dados ICMP e dos servidores. O painel atualiza
automaticamente a cada 30 segundos.

## Rede e implantação

Durante o desenvolvimento, a API escuta apenas em `127.0.0.1`. Para uma
implantação dentro da rede interna, configure `API_HOST=0.0.0.0` e limite a porta
da API no firewall aos clientes autorizados. Não exponha a porta MySQL à rede
inteira; permita somente a origem da API e mantenha a conta SQL em leitura.

## Personalização do painel

O modo **Editar painel** permite criar, renomear e remover seções, adicionar ou
remover cartões de equipamentos e arrastá-los para reordenar ou mover entre
seções do mesmo tipo. As seções iniciais são **INFRAESTRUTURA - ATIVOS DE REDE**,
**APLICAÇÕES PRINCIPAIS PF** e **INFRAESTRUTURA - SERVIDORES**.

Também é possível criar uma seção **Consumo de dados e tráfego** em qualquer
painel e incluir nela gráficos de itens numéricos do Zabbix. Cada gráfico pode
acompanhar períodos de 15 minutos, 1 hora, 3 horas, 6 horas, 1 dia, 7 dias ou
30 dias (mensal); os períodos mais longos são resumidos em até 300 amostras
para preservar a leitura do histórico sem sobrecarregar o painel.

Painéis novos começam vazios. Em **Adicionar indicador**, selecione primeiro um
equipamento do Zabbix e depois um de seus itens numéricos; listas grandes são
carregadas em páginas. Os indicadores podem ser renomeados, redimensionados e
reorganizados. No modo de edição, arraste a alça no canto inferior dos gráficos,
indicadores e cards de hosts para ajustar largura e altura; o tamanho fica salvo
no painel. Taxas de bits, taxas de bytes, quantidades de bytes e durações
são exibidas em unidades legíveis, sem alterar os valores armazenados no Zabbix.
Os históricos dos indicadores são consultados em lotes para reduzir chamadas à
API e ao banco de dados.

Ao criar um painel, escolha **Geral** ou **Rede**. O tipo **Rede** começa vazio
e permite adicionar indicadores de disponibilidade (item com `1 = UP` e
`0 = DOWN`) e gráficos temporais com até oito itens do mesmo equipamento e da
mesma unidade. A queda fica vermelha; a recuperação aparece como
**RECUPERANDO** por 30 segundos antes de ficar verde. Três ou mais mudanças de
estado em cinco minutos são indicadas como **OSCILANDO** em amarelo. Amostras
ausentes por mais de três minutos aparecem como **SEM DADOS**.

O tipo **Mapa** também começa vazio. Seus hosts e gráficos ficam em blocos de
grade encaixável: arraste para reordenar e use os controles de tamanho para
ampliar ou reduzir cada bloco. Os nós de host mostram um ícone de equipamento e
o estado de disponibilidade; gráficos podem combinar até oito séries da mesma
unidade e oferecem períodos de 15 minutos a 30 dias, escala vertical automática
e rótulos de horário.

A configuração dos painéis, as contas e as sessões ficam no banco próprio
`monitoring_nti`, separado do banco de métricas do Zabbix. Senhas continuam
armazenadas somente como hashes scrypt; tokens de sessão são armazenados como
hashes SHA-256. Os JSONs antigos servem apenas como fonte de importação inicial
e devem ser mantidos fora do Git e protegidos até o fim da migração.
