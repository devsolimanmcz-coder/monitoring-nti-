# NTIBIX — Monitoramento e Observabilidade

Painel de monitoramento e observabilidade desenvolvido com React, Node.js,
Express e MySQL/MariaDB do Zabbix.

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
oito horas e são encerradas quando o servidor reinicia.

## Requisitos

- Node.js 22 ou superior
- Conta MySQL/MariaDB dedicada com permissão `SELECT` nas tabelas `hosts`,
  `items`, `history` e `history_uint`
- A API precisa alcançar o servidor de banco na porta configurada

## Configuração local

Na pasta `monitoring-nti-pf-al`, instale as dependências e crie o arquivo local
de configuração:

```bash
npm install
cp .env.example .env
```

Edite `.env` com o nome real do esquema e a credencial de leitura. O arquivo
`.env` é ignorado pelo Git; não coloque credenciais na interface nem no repositório.

Inicie a API e o Vite juntos:

```bash
npm run dev
```

Abra o endereço local informado pelo Vite (normalmente
`http://localhost:5173`). O proxy encaminha `/api` para a API Express na porta
`3001`.

Verifique a conexão SQL diretamente em `http://localhost:3001/api/health`.
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

Painéis novos começam vazios. Em **Adicionar indicador**, selecione primeiro um
equipamento do Zabbix e depois um de seus itens numéricos; listas grandes são
carregadas em páginas. Os indicadores podem ser renomeados, redimensionados e
reorganizados. Taxas de bits, taxas de bytes, quantidades de bytes e durações
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
unidade e oferecem períodos de 15 minutos a 7 dias, escala vertical automática
e rótulos de horário.

A configuração compartilhada e as contas ficam, respectivamente, em
`data/dashboard.json` e `data/users.json`, separadas do banco do Zabbix. Os dois
arquivos JSON são versionados para migrar painéis e contas para outra máquina.
`users.json` contém hashes de senha e metadados das contas, nunca senhas em
texto puro; limite o acesso ao repositório. Arquivos temporários `.tmp` e `.env`
continuam fora do Git. As sessões ficam somente na memória do servidor, então
será necessário entrar novamente após reinicializações ou ao trocar de máquina.
