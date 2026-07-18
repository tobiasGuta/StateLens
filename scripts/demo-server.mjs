import { createServer } from "node:http";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const port = Number(options.port ?? 4173);
const secondaryPort = Number(options["secondary-port"] ?? 4174);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Demo port is invalid");

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const send = (status, contentType, body, headers = {}) => {
    response.writeHead(status, {
      "content-type": contentType,
      "cache-control": "no-store",
      ...headers,
    });
    response.end(body);
  };
  const json = (status, value, headers) =>
    send(status, "application/json", JSON.stringify(value), headers);
  try {
    if (url.pathname === "/")
      return send(200, "text/html; charset=utf-8", demoPage(port, secondaryPort));
    if (url.pathname === "/api/json")
      return json(200, { id: "demo_123", status: "active", synthetic: true });
    if (url.pathname === "/api/text")
      return send(200, "text/plain; charset=utf-8", "Synthetic StateLens plain text");
    if (url.pathname === "/api/xml")
      return send(200, "application/xml", "<demo><status>synthetic</status></demo>");
    if (url.pathname === "/api/sensitive-json")
      return json(200, {
        username: "demo-user",
        password: "fake-password",
        accessToken: "fake-access-token",
        nested: { clientSecret: "fake-client-secret" },
      });
    if (url.pathname === "/api/sensitive-headers")
      return json(
        200,
        { synthetic: true },
        {
          "set-cookie": "demo_session=fake-session; HttpOnly; SameSite=Strict",
          "x-demo-token": "fake-response-token",
        },
      );
    if (url.pathname === "/api/query-token")
      return json(200, {
        receivedTokenName: url.searchParams.has("access_token"),
        valueStored: false,
      });
    if (url.pathname === "/api/large-response")
      return send(200, "text/plain", "R".repeat(1_100_000));
    if (url.pathname === "/api/binary")
      return send(200, "application/octet-stream", Buffer.from([0, 1, 2, 3, 255, 254, 253]));
    if (url.pathname === "/api/base64")
      return send(200, "text/plain", Buffer.from("synthetic base64 body").toString("base64"), {
        "content-transfer-encoding": "base64",
      });
    if (url.pathname === "/api/redirect-in") {
      response.writeHead(302, { location: "/api/json" });
      return response.end();
    }
    if (url.pathname === "/api/redirect-out") {
      response.writeHead(302, { location: `http://localhost:${secondaryPort}/api/json` });
      return response.end();
    }
    if (url.pathname === "/api/slow") {
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      return json(200, { delayedMs: 3_500, synthetic: true });
    }
    if (url.pathname === "/api/unauthorized") return json(401, { error: "synthetic-unauthorized" });
    if (url.pathname === "/api/forbidden") return json(403, { error: "synthetic-forbidden" });
    if (url.pathname === "/api/form" && request.method === "POST") {
      const body = await readBody(request);
      const values = new URLSearchParams(body);
      return json(200, {
        fields: [...values.keys()],
        passwordReceived: values.has("password"),
        synthetic: true,
      });
    }
    if (url.pathname === "/api/json-request" && request.method === "POST") {
      const body = await readBody(request);
      return json(200, {
        requestBytes: Buffer.byteLength(body),
        authorizationHeaderReceived: Boolean(request.headers.authorization),
        synthetic: true,
      });
    }
    if (url.pathname === "/api/large-request" && request.method === "POST") {
      const body = await readBody(request);
      return json(200, { requestBytes: Buffer.byteLength(body), synthetic: true });
    }
    if (url.pathname === "/api/multipart" && request.method === "POST") {
      const body = await readBody(request);
      return json(200, {
        requestBytes: Buffer.byteLength(body),
        contentType: request.headers["content-type"],
        fileContentEchoed: false,
        synthetic: true,
      });
    }
    return json(404, { error: "synthetic-not-found" });
  } catch (error) {
    return json(500, {
      error: "synthetic-server-error",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`StateLens synthetic demo listening at http://localhost:${port}`);
  console.log(`Out-of-scope redirect target is http://localhost:${secondaryPort}`);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 3_000_000) {
        reject(new Error("Synthetic request exceeded 3 MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function demoPage(currentPort, otherPort) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>StateLens Synthetic Capture Harness</title><style>body{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem}button{margin:.3rem;padding:.55rem}pre{background:#eee;padding:1rem;min-height:3rem}</style></head><body><h1>StateLens Synthetic Capture Harness</h1><p>Reserved localhost data only. Primary ${currentPort}; secondary ${otherPort}.</p><div id="actions"></div><pre id="output">Ready</pre><script>
const output=document.querySelector('#output');
const actions=[['JSON','/api/json'],['Plain text','/api/text'],['XML','/api/xml'],['Sensitive JSON','/api/sensitive-json'],['Sensitive response header','/api/sensitive-headers'],['Query token','/api/query-token?access_token=fake-query-token'],['Large response','/api/large-response'],['Binary','/api/binary'],['Base64 text','/api/base64'],['In-scope redirect','/api/redirect-in'],['Out-of-port redirect','/api/redirect-out'],['Slow response','/api/slow'],['401','/api/unauthorized'],['403','/api/forbidden']];
for(const [label,path] of actions){const button=document.createElement('button');button.textContent=label;button.onclick=()=>run(()=>fetch(path));document.querySelector('#actions').append(button)}
add('URL-encoded form',()=>fetch('/api/form',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'username=demo&password=fake-password&csrfToken=fake-csrf'}));
add('Sensitive request header',()=>fetch('/api/json-request',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer fake-demo-token','x-csrf-token':'fake-csrf'},body:JSON.stringify({password:'fake-password',value:'safe'})}));
add('Large request',()=>fetch('/api/large-request',{method:'POST',headers:{'content-type':'text/plain'},body:'Q'.repeat(600000)}));
add('Multipart metadata',()=>{const form=new FormData();form.append('note','synthetic');form.append('upload',new Blob(['fake file content'],{type:'text/plain'}),'synthetic.txt');return fetch('/api/multipart',{method:'POST',body:form})});
add('Three identical',()=>Promise.all([fetch('/api/json'),fetch('/api/json'),fetch('/api/json')]));
add('Four concurrent',()=>Promise.all(['/api/json','/api/text','/api/slow','/api/forbidden'].map(path=>fetch(path))));
function add(label,action){const button=document.createElement('button');button.textContent=label;button.onclick=()=>run(action);document.querySelector('#actions').append(button)}
async function run(action){try{const result=await action();const list=Array.isArray(result)?result:[result];output.textContent='Completed '+list.length+' request(s): '+list.map(item=>item.status).join(', ')}catch(error){output.textContent=String(error)}}
</script></body></html>`;
}
