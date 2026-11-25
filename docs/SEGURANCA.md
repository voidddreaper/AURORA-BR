# Segurança do AuroraBR 1.0.0

Análise feita em 25/11/2026. Nenhum indício de malware foi encontrado. Nenhuma análise prova que um arquivo está 100% livre de malware; abaixo está o que foi verificado e como qualquer pessoa pode conferir.

## Hashes SHA-256

**Downloads da página de Releases:** compilados pelo GitHub Actions num Windows, a partir deste código; os hashes estão no arquivo `SHA256SUMS.txt` de cada Release e no log público da build.

**Versão 1.0.0 distribuída diretamente (compilada antes da publicação no GitHub e analisada neste relatório):**

| Arquivo | Tamanho (bytes) | SHA-256 |
|---|---|---|
| AuroraBR_1.0.0_x64-setup.exe | 4.109.232 | `04e5c25ea56a462e206ee81043c51a0d0bb0aea80a7034b9d151e2e2ed11bad1` |
| aurorabr.exe (dentro do instalador e do portátil) | 8.467.968 | `f0dd09714827b5acb65e8af62ad4fa57b29355e2589025d65936eca73b5e1ba5` |
| WebView2Loader.dll (Microsoft, assinado) | 160.880 | `86545b66cdb0603bc26b626fb9ad610cb6e71f28d468f5ea66df23b03dda96d5` |
| AuroraBR_portable.zip | 4.669.526 | `0bd48bbb7180a9cf955d6f337ab431feeb3d4660e758b3dc0bda16ec8fc0c573` |

## O que foi verificado

- **Código:** escrito do zero; nenhum uso de rede (`reqwest`, `TcpStream`, `fetch`, `WebSocket`…), de execução de programas (`std::process`) ou de código dinâmico (`eval`).
- **Permissões Tauri:** só controles da janela, diálogos de abrir/salvar, notificações e texto na área de transferência. A CSP só permite o canal local `ipc:`.
- **Executável:** importa só DLLs do Windows e o `WebView2Loader.dll` da Microsoft; sem empacotador, persistência (`Run`, `schtasks`), injeção em processos ou roubo de dados. `GetAsyncKeyState` vem da biblioteca de janelas `tao` (estado de Shift/Ctrl na própria janela) e `ShellExecuteW` do `tauri-runtime-wry` (abrir link clicado num diálogo).
- **Dependências:** `npm audit` e `cargo audit` com 0 vulnerabilidades conhecidas (jsPDF atualizado para 4.2.1 e rusqlite para 0.43 durante a auditoria).
- **Instalação:** por usuário, sem administrador, sem serviços nem tarefas agendadas.

## Alertas de antivírus

O instalador não tem assinatura digital de código, então:
- o Windows SmartScreen mostra um aviso;
- antivírus com heurística agressiva podem dar alerta genérico (ex.: `Trojan/Win.Generic`). Num teste no VirusTotal, 1 de 24 motores (AhnLab) deu esse alerta genérico e 23 deram limpo. É um falso positivo típico de programa novo e sem assinatura.

## Como verificar você mesmo

1. Confira o hash: `Get-FileHash .\AuroraBR_1.0.0_x64-setup.exe -Algorithm SHA256`.
2. Envie o arquivo ao [VirusTotal](https://www.virustotal.com) ou rode o Microsoft Defender.
3. Clique direito no `WebView2Loader.dll` → Propriedades → Assinaturas Digitais → "Microsoft Corporation".
4. Leia o código e compile você mesmo (veja o README) ou use o instalador gerado pelo GitHub Actions.
