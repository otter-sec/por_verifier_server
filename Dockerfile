FROM ubuntu:latest

# install dependencies using apt
RUN apt-get update && apt-get install -y nodejs npm git curl

# install rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly
ENV PATH="/root/.cargo/bin:${PATH}"

# clone and compile plonky2_por
RUN cd /opt && git clone https://github.com/otter-sec/por_v2.git
RUN cd /opt/por_v2 && cargo build --locked --release && mv target/release/plonky2_por /usr/local/bin/

# add node user
RUN useradd -m node

# copy the server code
COPY . /app

# install dependencies and build
WORKDIR /app
RUN npm install
RUN npm run build

# create database directory and set permissions
RUN mkdir -p /db && chown -R node:node /db

# expose server port
EXPOSE 3000

# run the server
USER node
CMD ["npm", "start"]